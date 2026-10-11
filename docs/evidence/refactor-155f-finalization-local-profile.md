# Finalization read overlap and CPU profile — October 11, 2026

Two reads now overlap existing finalization work. The lifecycle-decision read
starts with Router consumption and the credential claim. The founding-record
read starts with the capability read before the wallet transaction.

The change preserves the number of D1 calls. It removes two serial dependencies.
The wallet and capability still commit atomically. A competing shared-record
writer still causes one bounded reconciliation. Exact replay uses the existing
lifecycle decision and committed receipt.

## Verification

| Check | Result |
| --- | --- |
| Wallet-server type check and build | Pass |
| Wallet-state type fixtures | Pass |
| Real D1 credential reservation and wallet commit | Pass |
| Authorization storage transfer and relocation fences | Pass |
| Selected browser contracts | 6 pass |
| Profiled registration, exact replay, and verified first signature | 3 pass |
| Bloat check | Pass |

The six browser cases cover fresh session publication, registration replay and
reload, a lost finalization credential, lost recovery completion, mixed registration,
and signing admission during deferred NEAR provisioning.

The D1 scenario delays the founding-record read until the independent capability
read starts. Both reads finish before the wallet write. Its existing scenarios
also verify a refused directory claim, a lost claim reply, atomic rollback,
exact replay, and a competing wallet's successful write.

Reproduce the storage and type checks from `seams-wallet`:

```sh
node tests/e2e/registration-credential-reservation.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
pnpm -C packages/wallet-server type-check
pnpm -C tests type-check:wallet-state
```

Storage evidence remains in `.artifacts/registration-credential-reservation/proof.json`
and `.artifacts/r153/authorization-storage-transfer/evidence.json`. The new field
`independentCommitReads` records the delayed-read scenario and its D1 calls.
Browser logs and signature artifacts are in `.artifacts/r155f-finalize-local/`.

One existing assertion required an unchanged capability to attempt two commits.
That expectation predates `d51cfcd8`, which removed writes for unchanged capabilities.
The corrected assertion requires one attempt. It still verifies preservation of
concurrent wallet changes and suspension. Production behavior was unchanged by
this test correction.

## CPU finding

The existing local Worker stack ran with Chromium and an implicit NEAR account.
The debugger sampled the Gateway at a requested interval of 100 microseconds.
Each profile starts before the finalization POST and stops after its reply.
The scenario then repeats finalization and independently verifies the first signature.

| Sample | Total samples | Samples under session-seal `addLock` | Share |
| --- | ---: | ---: | ---: |
| 1 | 286 | 228 | 79.72% |
| 2 | 288 | 226 | 78.47% |
| 3 | 303 | 238 | 78.55% |

The dominant stack is `addSigningSessionSealLock` → `shamir3pass_add_lock` →
`num_bigint` modular arithmetic. It belongs to server session sealing after
registration. The shared capability collection is bounded and did not dominate
these local profiles.

The [machine-readable record](refactor-155f-finalization-local-profile.json)
contains the source description, built Gateway checksum, profile checksums,
and sample counts. The local diagnostic config and scenario remain beside the
profiles in `.artifacts/r155f-finalize-local/`.

These are sampled execution shares, not absolute CPU durations. Profile time
deltas include waits and cannot reconstruct Worker CPU usage. Debugger overhead
also prevents these runs from serving as latency benchmarks. They identify a
likely source of the hosted finalization CPU cost. They do not establish its
exact contribution to the earlier 265 ms observation.

The next candidate is to overlap existing seal computation with network waits,
once authority and input binding permit it. Preserve the session binding, expiry,
and durable commit requirements. No sealing change is included here.

No hosted deployment or measurement occurred during this profile work. The later
[hosted comparison](refactor-155f-finalization-overlap-hosted.md) measures the read
and sealing overlaps together. It verifies the new ordering and establishes no
clear total-latency gain. The earlier **3.530 s registration / 4.204 s combined**
early-preflight result remains a separate historical measurement.
