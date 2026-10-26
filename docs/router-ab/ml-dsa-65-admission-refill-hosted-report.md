# ML-DSA admission and refill: hosted result

The local test proves that the candidate preserves untouched material after an unadmitted operation expires.
The hosted four-wallet run balances both material ledgers. It does not establish an overall preparation speed improvement or consistent eight-second signing.

## Performance

The test uses four fully verified wallets, two preparation slots, sixteen pairs per wallet, and a sixty-second wallet cooldown.
Ordinary refill jobs prepare four candidates. Signing consumes two candidates at a time.
The runtime default remains one preparation slot. Preparation stays on Workers.
Wallet-seed recovery, standard FIPS export, and per-wallet pool capacity remain unchanged. GPU work remains deferred.

| Phase | Verified signatures | Server signing failures | Successful HTTP seconds: min / median / max | Under eight seconds | Signatures/minute including reserve restoration |
| --- | ---: | ---: | --- | ---: | ---: |
| warmup | 39 | 1 | 0.696 / 2.140 / 7.315 | 39 | 3.702 |
| completion | 24 | 0 | 0.730 / 1.899 / 10.579 | 22 | 3.606 |

Neither phase returns an empty-pool response. The completion phase's two slower successful calls take 9.492 and 10.579 seconds.
HTTP latency excludes earlier admission waits. Complete demand latency includes cooldown, contention, and retries.
Warm-up demand latency has a 15.351-second median and 116.167-second maximum. Completion has a 12.275-second median and 28.582-second maximum.
These private Router calls exclude browser approval, public Gateway transport, and NEAR confirmation.
The finite rates include restoring the initial reserve. They are not maximum-capacity estimates.

| Phase | Producer | Four-candidate jobs | A CPU median, seconds | A wall seconds: min / median / max | Serialized-to-publication median, seconds |
| --- | --- | ---: | ---: | --- | ---: |
| warmup | preparer-a | 20 | 8.787 | 16.892 / 18.915 / 22.581 | 0.692 |
| warmup | preparer-a-secondary | 35 | 4.023 | 8.022 / 8.889 / 12.791 | 0.720 |
| completion | preparer-a | 13 | 9.043 | 17.976 / 19.781 / 25.679 | 0.770 |
| completion | preparer-a-secondary | 13 | 4.196 | 9.004 / 9.249 / 12.201 | 0.770 |

The primary slot remains much slower than the secondary slot. Both use the same participant binaries.
Matched setup samples have equal protocol traffic and reused topology caches. Rebuilding those caches does not explain the difference.
The preceding campaign has different workload and deployment conditions. Its roughly one-second publication median is a reference, not a controlled speedup claim.
The larger publication transaction and extra inventory scan have no isolated hosted control in this run.

Target enrollment/recovery: 7.473–10.910 seconds, median 9.651.
Prior generic registration preparation: 58.318–107.870 seconds, median 87.892.
These are separate costs. Three preserved setup failures prevented completing the planned eight-wallet cohort.

## Failures and accounting

Two generic preparation requests return HTTP 500. A replacement registration also returns HTTP 500.
Four wallets complete canonical enrollment and recovery. The incomplete identities receive no signing load.
No non-target preparation job occurs in the measured phase profiles. Idle non-target actors remain a comparison limitation.

One warm-up signing operation fails after a participant B loadShed event. A records two takes and B records one.
The thirteen remaining IDs are retired at both participants, with no retained take event. Retirement alone does not distinguish burn from an unlogged consumption.
This admitted failure remains separate from the Declined recovery change. Its resource cost remains visible.
The completion phase has no failed signing operation and no loadShed event.

- Warm-up: 64 initial + 131 newly paired = 118 observed taken + 13 retired without observed take + 64 final pairs.
- Completion: 64 initial + 67 newly paired = 67 observed taken + 64 final pairs.

Both accounting windows have stable fingerprints, exact runtime versions, and no unaccounted pairs.
There is no observed reuse across 203 A take IDs and 202 B take IDs. The one-sided take belongs to the preserved failed operation.
Every successful operation has matching participant takes.
The driver field functionalPassed checks driver errors and minimum success counts. It does not mean every signing operation succeeded.
Accounting qualification is separate from latency qualification and production release approval.

No natural expired-reservation recovery event occurs in this hosted capture. Reclamation evidence remains the controlled local Worker E2E.
That test retains all sixteen pairs after interrupted admission and verifies a fresh signature using reclaimed material.

## Next performance work

Investigate the primary slot's correlation CPU cost and the B execution loadShed failure.
Assess whether both confirmed role fences can safely retain untouched material after an admitted failure. Current expiry-only recovery remains conservative for admitted operations.
Do not increase pool capacity or infer eight-wallet capacity from this run.

## Evidence and cleanup

The offline replay verifies 75 standard signatures and rejects 75 altered messages.
It reproduces summaries, stable fingerprints, material accounting, producer outcomes, and profile counts.
The archive preserves all three failed setups and the failed signing operation.
All eight temporary Workers are deleted and independently confirmed absent. Uploaded credential payloads are removed locally.
Private fixtures and raw credential data are excluded from the archive. The inherited Rust bloat check remains unchanged at 13,972 versus 13,754 lines.

[Evidence index](../evidence/ml-dsa-65-admission-refill-hosted-20261026.json) and [replay archive](../evidence/ml-dsa-65-admission-refill-hosted-20261026.tar.gz).
