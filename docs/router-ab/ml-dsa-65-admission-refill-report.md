# ML-DSA admission and refill optimization

The candidate preserves untouched material after an expired, unadmitted operation.
It also publishes a complete role job through one bounded request and transaction.
The [hosted four-wallet result](ml-dsa-65-admission-refill-hosted-report.md) is complete. Both accounting ledgers balance, and 75 retained signatures verify.
It does not establish an overall preparation speed improvement or consistent eight-second signing.

## Performance purpose

The preceding hosted run lost twelve pairs around a canceled admission. That equals 24 candidates or six four-candidate refill jobs.
Its two slow A publication calls took 26.668 and 21.604 seconds, with only 91 and 111 milliseconds of CPU.
Their authorization, transaction, storage, and response waits remain unresolved.
One publication request removes a serial dispatch and commit. Its larger transaction could increase blocking or memory use.

## Changes and validation

Reservations retain their exact request binding. Inventory checks expired reservations against Router authority before reclaiming them.
Only Declined permits reclamation. The local transaction fences delayed use and releases untouched reservations.
Admitted terminal failures retain conservative retirement. Recovery errors leave material unavailable for later recovery.
Key, epoch, material lifetime, and single-use checks remain enforced.

The old Worker bundles fail the composed scenario because unadmitted material is lost.
The candidate retains all sixteen reserved pairs. A fresh verified signature consumes reclaimed material.
Replay requests after Declined are refused. This does not inject an already-authorized delayed reservation response.
All three signatures verify. Restart, lost publication replies, interrupted producers, and consumed-material refusal also pass.
The existing native durable-pool E2E passes.

The first fixture attempt did not intercept Router admission. Its result is excluded from the before/after evidence.
Independent review found a cross-key counting error in the candidate. The corrected code keeps recovery and readiness scoped to the requested key.
The review also identified an extra inventory transaction and metadata scan. Hosted measurements include this overhead, without an isolated control.

## Hosted comparison

The completed run measures successful signatures with full reserve restoration, retired pairs, publication waits, and empty-pool waits.
Three setup failures limit the cohort to four fully verified wallets. Two preparation slots, sixteen pairs per wallet, and the sixty-second cooldown stay unchanged.
Keep two-at-once consumption, wallet-seed recovery, standard FIPS export, and preparation on Workers.
GPU work remains deferred. The user approved the exact eight deployments and credential uploads. All eight temporary Workers are now deleted.
The required bloat check remains at the inherited 13,972 duplicated Rust lines against a 13,754-line baseline.

[Local evidence](../evidence/ml-dsa-65-admission-refill-local-20261026.json) and [full artifact](../evidence/ml-dsa-65-admission-refill-local-20261026.json.gz).
